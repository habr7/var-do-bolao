import Link from "next/link";
import { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type TabItem = {
  id: string;
  label: string;
  icon?: ReactNode;
};

export function Tabs({
  codigo,
  active,
  items,
}: {
  codigo: string;
  active: string;
  items: TabItem[];
}) {
  return (
    <div className="-mx-5 overflow-x-auto px-5 md:mx-0 md:px-0">
      <div className="flex w-fit gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
        {items.map((item) => {
          const isActive = item.id === active;
          const href =
            item.id === "ranking"
              ? `/app/bolao/${codigo}`
              : `/app/bolao/${codigo}?tab=${item.id}`;
          return (
            <Link
              key={item.id}
              href={href}
              scroll={false}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                isActive
                  ? "bg-[var(--color-verde-conexao)] text-[var(--color-verde-gramado-deep)]"
                  : "text-white/65 hover:text-white",
              )}
            >
              {item.icon} {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
