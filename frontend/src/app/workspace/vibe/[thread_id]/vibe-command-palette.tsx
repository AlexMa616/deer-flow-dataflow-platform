"use client";

import type { ComponentType } from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

export type VibePaletteItem = {
  id: string;
  icon?: ComponentType<{ className?: string }>;
  keywords?: string[];
  label: string;
  onSelect: () => void;
  shortcut?: string;
  subtitle?: string;
};

export type VibePaletteGroup = {
  heading: string;
  items: VibePaletteItem[];
};

export function VibeCommandPalette({
  description,
  emptyLabel,
  groups,
  inputPlaceholder,
  open,
  title,
  onOpenChange,
}: {
  description: string;
  emptyLabel: string;
  groups: VibePaletteGroup[];
  inputPlaceholder: string;
  open: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      className="max-w-2xl overflow-hidden rounded-[28px] border border-white/10 bg-[#070a10] p-0 text-slate-100 shadow-[0_28px_90px_rgba(2,6,23,0.48)] backdrop-blur-xl"
    >
      <CommandInput
        placeholder={inputPlaceholder}
        className="text-slate-100 placeholder:text-slate-500"
      />
      <CommandList className="max-h-[460px] bg-[linear-gradient(180deg,#070a10_0%,#0b1020_100%)]">
        <CommandEmpty className="text-slate-500">{emptyLabel}</CommandEmpty>
        {groups.map((group) =>
          group.items.length > 0 ? (
            <CommandGroup
              key={group.heading}
              heading={group.heading}
              className="[&_[cmdk-group-heading]]:text-slate-500"
            >
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.id}
                    className="rounded-2xl px-3 py-3 text-slate-200 data-[selected=true]:bg-white/8 data-[selected=true]:text-white"
                    value={[item.label, item.subtitle, ...(item.keywords ?? [])]
                      .filter(Boolean)
                      .join(" ")}
                    onSelect={() => {
                      onOpenChange(false);
                      item.onSelect();
                    }}
                  >
                    {Icon ? <Icon className="size-4 text-slate-500" /> : null}
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{item.label}</div>
                      {item.subtitle ? (
                        <div className="truncate text-xs text-slate-500">
                          {item.subtitle}
                        </div>
                      ) : null}
                    </div>
                    {item.shortcut ? (
                      <CommandShortcut className="text-slate-600">
                        {item.shortcut}
                      </CommandShortcut>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null,
        )}
      </CommandList>
    </CommandDialog>
  );
}
