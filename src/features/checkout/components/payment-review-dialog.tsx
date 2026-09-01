import { FileCheck, LoaderCircle, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Input, Textarea } from "#/components/pro/base/fields/input";
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

export function PaymentReviewDialog({
	disabled,
	onSubmitted,
	orderId,
	transactionHash,
}: {
	disabled?: boolean;
	onSubmitted: () => void;
	orderId: string;
	transactionHash: string;
}) {
	const [open, setOpen] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [description, setDescription] = useState("");
	const [evidence, setEvidence] = useState<File | null>(null);

	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger asChild>
				<Button
					className="mb-3 h-12 w-full rounded-none border-border bg-transparent text-foreground text-base hover:bg-accent hover:text-accent-foreground"
					disabled={disabled}
					type="button"
					variant="outline"
				>
					<FileCheck />
					{disabled ? m.checkout_review_pending() : m.checkout_review_title()}
				</Button>
			</DialogTrigger>
			<DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{m.checkout_review_title()}</DialogTitle>
					<DialogDescription className="text-muted-foreground">
						{m.checkout_review_description()}
					</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-4"
					onSubmit={async (event) => {
						event.preventDefault();
						if (!evidence || description.trim().length < 10) {
							toast.error(m.checkout_review_required());
							return;
						}
						setSubmitting(true);
						try {
							const form = new FormData();
							form.set("description", description.trim());
							form.set("evidence", evidence);
							if (transactionHash.trim())
								form.set("transactionHash", transactionHash.trim());
							const response = await fetch(
								`/api/checkout/${encodeURIComponent(orderId)}/review`,
								{ method: "POST", body: form },
							);
							if (!response.ok) throw new Error("review_failed");
							toast.success(m.checkout_review_submitted());
							onSubmitted();
							setOpen(false);
						} catch {
							toast.error(m.checkout_review_failed());
						} finally {
							setSubmitting(false);
						}
					}}
				>
					<div className="space-y-2">
						<label className="font-medium text-sm" htmlFor="review-description">
							{m.checkout_review_details_label()}
						</label>
						<Textarea
							className="min-h-24 rounded-none border-input bg-background text-foreground placeholder:text-muted-foreground"
							disabled={submitting}
							id="review-description"
							maxLength={1000}
							onChange={(event) => setDescription(event.target.value)}
							placeholder={m.checkout_review_details_placeholder()}
							required
							value={description}
						/>
					</div>
					<div className="space-y-2">
						<label className="font-medium text-sm" htmlFor="review-evidence">
							{m.checkout_review_evidence_label()}
						</label>
						<Input
							accept="image/jpeg,image/png,image/webp"
							className="rounded-none border-input bg-background text-foreground"
							disabled={submitting}
							id="review-evidence"
							onChange={(event) =>
								setEvidence(event.target.files?.item(0) ?? null)
							}
							required
							type="file"
						/>
						<p className="text-muted-foreground text-xs">
							{m.checkout_review_evidence_hint()}
						</p>
					</div>
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
							disabled={submitting}
							type="submit"
						>
							{submitting ? (
								<LoaderCircle className="animate-spin" />
							) : (
								<Send />
							)}
							{m.checkout_review_submit()}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
