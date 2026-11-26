import type { ComponentProps, ReactNode } from "react";
import { Upload } from "lucide-react";
import { buttonVariants } from "./button";

function FileInput({
  children,
  ...props
}: Omit<ComponentProps<"input">, "type" | "children"> & { children: ReactNode }) {
  return (
    <label className={buttonVariants({
      variant: "outline",
      className: "h-auto min-h-9 w-fit max-w-full cursor-pointer flex-row whitespace-normal has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/30",
    })}>
      <Upload aria-hidden="true" />
      <span className="min-w-0 break-words">{children}</span>
      <input type="file" className="sr-only" {...props} />
    </label>
  );
}

export { FileInput };
