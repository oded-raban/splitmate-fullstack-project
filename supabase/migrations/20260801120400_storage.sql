-- =============================================================================
-- SplitMate — 05. Receipt storage
-- =============================================================================
-- Receipts are photographs of real purchases: they show what a household buys,
-- where, and when. They are treated as private data, not as public assets.
--
-- THE PATH CONVENTION IS THE SECURITY MODEL
--   Every object is stored at:   {household_id}/{expense_id}/{uuid}.webp
--   The policies below parse the FIRST path segment and check membership of
--   that household. So authorization is derived from the object's location, and
--   an object cannot be placed anywhere its uploader lacks access to.
--
--   This is why the bucket is private and reads go through short-lived signed
--   URLs rather than public links: a public bucket would make every receipt
--   readable by anyone who could guess or leak a URL, with no revocation.
-- =============================================================================

-- Create the bucket. `public = false` means no unauthenticated URL ever works;
-- the only way to read an object is a signed URL or an authorised API call.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  5242880,  -- 5 MB. Images are compressed client-side to WebP before upload, so
            -- this ceiling is generous; it exists to stop an accidental upload
            -- of a 40 MB raw photo from consuming the household's quota.
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;


-- Safely extract the household id from an object path.
--
-- A naive `((storage.foldername(name))[1])::uuid` throws error 22P02 on any
-- object whose first segment is not a UUID — and a policy that throws is a
-- policy that can be used to probe the system. This helper returns NULL for a
-- malformed path instead, so such an object simply matches no policy and is
-- inaccessible.
create or replace function public.storage_household_id(p_object_name text)
returns uuid
language sql
immutable
as $$
  select case
    when (storage.foldername(p_object_name))[1] ~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(p_object_name))[1])::uuid
    else null
  end;
$$;

grant execute on function public.storage_household_id(text) to authenticated;


-- Read: any member of the owning household. This policy is also what makes
-- `createSignedUrl` succeed or fail — signed URLs are issued only for objects
-- the requesting user is allowed to read.
create policy receipts_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and public.is_household_member(public.storage_household_id(name))
  );

-- Write: members of the household named in the path. Uploads go directly from
-- the browser to Storage using the user's own JWT, so this policy is the only
-- thing standing between a client and the bucket — proxying uploads through a
-- serverless function would double the bandwidth and hit request size limits
-- without adding security, since the check would be the same.
create policy receipts_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and public.is_household_member(public.storage_household_id(name))
  );

-- Replace an existing receipt (re-uploading a clearer photo).
create policy receipts_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'receipts'
    and public.is_household_member(public.storage_household_id(name))
  )
  with check (
    bucket_id = 'receipts'
    and public.is_household_member(public.storage_household_id(name))
  );

-- Delete: the uploader, or an admin/owner cleaning up. `owner_id` is set by
-- Storage to the uploading user's id.
create policy receipts_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'receipts'
    and (
      owner_id = auth.uid()::text
      or public.has_household_role(
           public.storage_household_id(name),
           array['owner', 'admin']::public.household_role[]
         )
    )
  );
