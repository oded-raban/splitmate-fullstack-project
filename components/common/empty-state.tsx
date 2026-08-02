/**
 * The "there is nothing here yet" panel.
 * =============================================================================
 * Empty is the first state every screen is in, and the one most likely to lose a
 * new user. Each instance therefore has to say what would normally be here, why
 * it is worth having, and offer the single action that fills it — which is why
 * the action is a required-looking part of the shape rather than an afterthought.
 *
 * A plain component and not a Client Component: it renders text and a link.
 */

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-full">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <p className="font-medium">{title}</p>
          <p className="text-muted-foreground mx-auto max-w-sm text-sm">
            {description}
          </p>
        </div>
        {action}
      </CardContent>
    </Card>
  );
}
