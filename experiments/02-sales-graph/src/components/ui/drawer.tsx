import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { cn } from "cn";

const Drawer = DrawerPrimitive.Root;
const DrawerTrigger = DrawerPrimitive.Trigger;
const DrawerClose = DrawerPrimitive.Close;

function DrawerContent({ className, children, ...props }: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPrimitive.Portal>
      <DrawerPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50" />
      <DrawerPrimitive.Content data-slot="drawer-content" className={cn("fixed inset-y-0 right-0 z-50 flex w-[min(380px,100vw)] flex-col border-l bg-background text-foreground outline-none", className)} {...props}>
        {children}
      </DrawerPrimitive.Content>
    </DrawerPrimitive.Portal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="drawer-header" className={cn("flex flex-col gap-2 p-6", className)} {...props} />;
}
function DrawerTitle({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return <DrawerPrimitive.Title className={cn("text-base font-semibold", className)} {...props} />;
}
function DrawerDescription({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return <DrawerPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export { Drawer, DrawerTrigger, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription };
