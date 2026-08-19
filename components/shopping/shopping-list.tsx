"use client";

/**
 * The collaborative shopping list.
 * =============================================================================
 * The only screen in SplitMate that is genuinely multiplayer: two people can be
 * in the same supermarket, and an item one of them ticks has to disappear from
 * the other's phone before they put a second carton of milk in the trolley.
 *
 * THREE MECHANISMS, AND WHY EACH IS NEEDED
 *
 *   1. OPTIMISTIC LOCAL STATE — a tick applies instantly, before the server has
 *      heard about it. On supermarket wifi a round trip is easily 400ms, and a
 *      checkbox that takes that long to respond gets tapped again.
 *
 *   2. REALTIME SUBSCRIPTION — Postgres streams every insert, update and delete
 *      on this household's items, so other people's changes arrive without a
 *      refresh. The subscription is filtered server-side on `household_id`,
 *      which is why that column is denormalised onto `shopping_items` in the
 *      first place: without it every client would receive every household's
 *      changes and have to discard them locally, which is a data leak rather
 *      than an inefficiency.
 *
 *   3. RECONCILIATION — the server's version always wins. An optimistic change
 *      is replaced the moment the real row arrives, and a failed write is rolled
 *      back with a toast. The client never gets to be the source of truth about
 *      what is on the list.
 *
 * WHY NOT `useOptimistic`
 * React's `useOptimistic` ties optimistic state to the lifetime of one pending
 * action and discards it when that action settles. Here the correction does not
 * arrive from the action's return value — it arrives later, over a WebSocket,
 * possibly caused by somebody else's phone. The state has to outlive the action
 * that started it, so it is held in ordinary state and reconciled by id.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, ShoppingCart, Trash2, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";

import {
  addShoppingItem,
  removeShoppingItem,
  toggleShoppingItem,
} from "@/lib/actions/shopping";
import type { ShoppingItemRow } from "@/lib/data/shopping";
import type { MemberDetail } from "@/lib/data/households";
import type { CategoryOption } from "@/lib/data/expenses";
import { displayNameOf } from "@/lib/display";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { CheckoutDialog } from "@/components/shopping/checkout-dialog";

interface ShoppingListProps {
  householdId: string;
  listId: string;
  currency: string;
  initialItems: ShoppingItemRow[];
  members: MemberDetail[];
  categories: CategoryOption[];
  viewerId: string;
  today: string;
}

/** A row that exists on this client but not yet in the database. */
interface PendingItem extends ShoppingItemRow {
  pending: true;
}

type Row = ShoppingItemRow | PendingItem;

const isPending = (row: Row): row is PendingItem => "pending" in row;

export function ShoppingList({
  householdId,
  listId,
  currency,
  initialItems,
  members,
  categories,
  viewerId,
  today,
}: ShoppingListProps) {
  const [items, setItems] = useState<Row[]>(initialItems);
  const [draft, setDraft] = useState("");
  const [isLive, setIsLive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Ticks applied locally that the server has not confirmed.
   *
   * Kept separate from `items` rather than written into it, so that when the
   * real row arrives over Realtime it can simply replace the row and this map
   * drops the entry. Merging them would mean working out, on every incoming
   * event, whether the server's value reflects this client's change or somebody
   * else's — and getting that wrong makes a tick flicker back off.
   */
  const [optimisticChecks, setOptimisticChecks] = useState<Map<string, boolean>>(
    new Map(),
  );

  const supabase = useMemo(() => createClient(), []);

  const nameOf = useCallback(
    (userId: string | null) => {
      if (!userId) return "someone";
      if (userId === viewerId) return "you";
      const member = members.find((candidate) => candidate.userId === userId);
      return member ? displayNameOf(member) : "a former member";
    },
    [members, viewerId],
  );

  /**
   * Applies one row from the database, replacing any local guess for it.
   *
   * Written as a single upsert-by-id rather than separate insert and update
   * paths because Realtime does not guarantee that an INSERT event arrives
   * before the UPDATE that follows it. Treating both as "this is the row now"
   * makes ordering irrelevant.
   */
  const applyRow = useCallback((row: ShoppingItemRow) => {
    setItems((current) => {
      const index = current.findIndex((item) => item.id === row.id);
      if (index === -1) return [...current, row];
      const next = [...current];
      next[index] = row;
      return next;
    });

    setOptimisticChecks((current) => {
      if (!current.has(row.id)) return current;
      const next = new Map(current);
      next.delete(row.id);
      return next;
    });
  }, []);

  const dropRow = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  // ---------------------------------------------------------------- realtime

  useEffect(() => {
    const channel = supabase
      .channel(`shopping:${householdId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "shopping_items",
          // Filtered by Postgres, not here. An unfiltered subscription would
          // deliver other households' items to this browser and rely on client
          // code to ignore them, which is a disclosure rather than a bug.
          filter: `household_id=eq.${householdId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            dropRow((payload.old as { id: string }).id);
            return;
          }

          const row = payload.new as Record<string, unknown>;

          // A checkout archives items rather than deleting them, which arrives
          // as an UPDATE. From this screen's point of view the item is gone.
          if (row["archived_at"]) {
            dropRow(row["id"] as string);
            return;
          }

          applyRow({
            id: row["id"] as string,
            name: row["name"] as string,
            quantity: (row["quantity"] as string | null) ?? null,
            estimatedMinor: null,
            addedBy: row["added_by"] as string,
            checkedBy: (row["checked_by"] as string | null) ?? null,
            checkedAt: (row["checked_at"] as string | null) ?? null,
            position: (row["position"] as number) ?? 0,
            createdAt: row["created_at"] as string,
          });
        },
      )
      .subscribe((status) => {
        // Surfaced in the UI. A collaborative list that has silently stopped
        // being collaborative is worse than one that says so, because the whole
        // point is trusting that what you see is what your flatmate sees.
        setIsLive(status === "SUBSCRIBED");
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, householdId, applyRow, dropRow]);

  // ------------------------------------------------------------------ writes

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (!name) return;

    // Cleared immediately so the next item can be typed without waiting. People
    // add three things in a row; making each one wait for a round trip turns a
    // five-second task into twenty.
    setDraft("");
    inputRef.current?.focus();

    const temporaryId = `pending:${crypto.randomUUID()}`;

    setItems((current) => [
      ...current,
      {
        id: temporaryId,
        name,
        quantity: null,
        estimatedMinor: null,
        addedBy: viewerId,
        checkedBy: null,
        checkedAt: null,
        position: 0,
        createdAt: new Date().toISOString(),
        pending: true,
      },
    ]);

    const result = await addShoppingItem({ householdId, listId, name });

    // The row itself arrives over Realtime; this only removes the placeholder.
    // Removing it unconditionally is safe because the real row carries a
    // different id, so a slow WebSocket shows a brief gap rather than a
    // duplicate — and a duplicate is the worse of the two on a shopping list.
    dropRow(temporaryId);

    if (!result.ok) {
      toast.error(result.error.message);
      setDraft(name);
    }
  }

  async function handleToggle(item: Row, checked: boolean) {
    if (isPending(item)) return;

    setOptimisticChecks((current) => new Map(current).set(item.id, checked));

    const result = await toggleShoppingItem({
      householdId,
      itemId: item.id,
      checked,
    });

    if (!result.ok) {
      setOptimisticChecks((current) => {
        const next = new Map(current);
        next.delete(item.id);
        return next;
      });
      toast.error(result.error.message);
    }
  }

  async function handleRemove(item: Row) {
    if (isPending(item)) return;

    const snapshot = items;
    dropRow(item.id);

    const result = await removeShoppingItem({ householdId, itemId: item.id });

    if (!result.ok) {
      setItems(snapshot);
      toast.error(result.error.message);
    }
  }

  // ------------------------------------------------------------------ render

  /**
   * Whether an item reads as ticked right now — the local guess if there is one,
   * otherwise what the database says.
   */
  const checkedState = useCallback(
    (item: Row) => optimisticChecks.get(item.id) ?? item.checkedAt !== null,
    [optimisticChecks],
  );

  // Ticked items sink to the bottom rather than disappearing, so a mistake can
  // be undone and so the trolley's contents stay visible. `optimisticChecks`
  // participates, which is what makes a row sink on tap rather than on response.
  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const aChecked = checkedState(a);
      const bChecked = checkedState(b);
      if (aChecked !== bChecked) return aChecked ? 1 : -1;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }, [items, checkedState]);

  const checkedIds = sorted.filter((item) => checkedState(item)).map((item) => item.id);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Shopping</h2>
        <span
          className="text-muted-foreground flex items-center gap-1.5 text-xs"
          title={
            isLive
              ? "Changes from your roommates appear here as they happen"
              : "Reconnecting — changes may be delayed"
          }
        >
          {isLive ? (
            <>
              <Wifi className="size-3.5" aria-hidden="true" />
              Live
            </>
          ) : (
            <>
              <WifiOff className="size-3.5" aria-hidden="true" />
              Offline
            </>
          )}
        </span>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <form onSubmit={handleAdd} className="flex gap-2">
            <Input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Milk, bread, washing-up liquid…"
              maxLength={80}
              autoComplete="off"
              aria-label="Add an item"
              data-testid="shopping-input"
            />
            <Button type="submit" disabled={!draft.trim()} data-testid="shopping-add">
              <Plus className="size-4" />
              <span className="sr-only sm:not-sr-only">Add</span>
            </Button>
          </form>

          {sorted.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              Nothing on the list. Add what you have run out of and everyone will see
              it.
            </p>
          ) : (
            <ul className="divide-border divide-y" data-testid="shopping-items">
              {sorted.map((item) => {
                const checked = checkedState(item);

                return (
                  <li
                    key={item.id}
                    className="group flex items-center gap-3 py-2.5"
                    data-testid="shopping-item"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(next) => handleToggle(item, next === true)}
                      disabled={isPending(item)}
                      aria-label={`Mark ${item.name} as ${checked ? "not bought" : "bought"}`}
                    />

                    <span className="min-w-0 flex-1">
                      <span
                        className={
                          checked
                            ? "text-muted-foreground text-sm line-through"
                            : "text-sm"
                        }
                      >
                        {item.name}
                      </span>
                      {item.quantity ? (
                        <span className="text-muted-foreground text-sm">
                          {" "}
                          × {item.quantity}
                        </span>
                      ) : null}
                      {checked && item.checkedBy ? (
                        <span className="text-muted-foreground block text-xs">
                          got by {nameOf(item.checkedBy)}
                        </span>
                      ) : null}
                    </span>

                    {isPending(item) ? (
                      <Loader2
                        className="text-muted-foreground size-4 animate-spin"
                        aria-label="Saving"
                      />
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={() => handleRemove(item)}
                        aria-label={`Remove ${item.name}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {checkedIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="secondary">
            {checkedIds.length} item{checkedIds.length === 1 ? "" : "s"} ticked
          </Badge>
          <CheckoutDialog
            householdId={householdId}
            currency={currency}
            itemIds={checkedIds}
            members={members}
            categories={categories}
            viewerId={viewerId}
            today={today}
            trigger={
              <Button size="sm" data-testid="checkout-open">
                <ShoppingCart className="size-4" />
                Turn into an expense
              </Button>
            }
          />
        </div>
      ) : null}
    </div>
  );
}
