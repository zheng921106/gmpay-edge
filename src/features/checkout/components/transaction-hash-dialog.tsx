import { Check, LoaderCircle, Send } from "lucide-react";
import { useState } from "react";
import { Input } from "#/components/pro/base/fields/input";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import { m } from "#/paraglide/messages";

export function TransactionHashDialog({
	onSubmit,
	onValueChange,
	submitting,
	value,
}: {
	onSubmit: () => Promise<boolean>;
	onValueChange: (value: string) => void;
	submitting: boolean;
	value: string;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger asChild>
				<Button
					className="h-12 w-full rounded-none bg-emerald-500 text-emerald-950 text-base hover:bg-emerald-400 dark:bg-[#b6ff43] dark:text-[#10120e] dark:hover:bg-[#d4ff8a]"
					type="button"
				>
					<Check />
					{m.checkout_transferred()}
				</Button>
			</DialogTrigger>
			<DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{m.checkout_tx_hash_title()}</DialogTitle>
					<DialogDescription className="text-muted-foreground">
						{m.checkout_tx_hash_desc()}
					</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-4"
					onSubmit={async (event) => {
						event.preventDefault();
						if (await onSubmit()) setOpen(false);
					}}
				>
					<div className="space-y-2">
						<label className="font-medium text-sm" htmlFor="checkout-tx-hash">
							{m.checkout_tx_hash_label()}
						</label>
						<Input
							autoComplete="off"
							autoFocus
							className="h-11 rounded-none border-input bg-background text-foreground placeholder:text-muted-foreground"
							disabled={submitting}
							id="checkout-tx-hash"
							onChange={(event) => onValueChange(event.target.value)}
							placeholder={m.checkout_tx_hash_placeholder()}
							value={value}
						/>
					</div>
					<p className="text-muted-foreground text-xs leading-relaxed">
						{m.checkout_tx_hash_hint()}
					</p>
					<DialogFooter>
						<DialogClose asChild>
							<Button
								className="rounded-none border-border bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground"
								disabled={submitting}
								type="button"
								variant="outline"
							>
								{m.common_cancel()}
							</Button>
						</DialogClose>
						<Button
							className="rounded-none bg-emerald-500 text-emerald-950 hover:bg-emerald-400 dark:bg-[#b6ff43] dark:text-[#10120e] dark:hover:bg-[#d4ff8a]"
							disabled={submitting || !value.trim()}
							type="submit"
						>
							{submitting ? (
								<LoaderCircle className="animate-spin" />
							) : (
								<Send />
							)}
							{m.checkout_tx_hash_submit()}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
