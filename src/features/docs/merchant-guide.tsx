import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getLocale } from "#/paraglide/runtime";
import englishGuide from "../../../docs/en-US/MERCHANT_API.md?raw";
import chineseGuide from "../../../docs/zh-CN/MERCHANT_API.md?raw";

const headingIds: Record<string, string> = {
	"GMPay 创建订单": "gmpay",
	"Create a GMPay order": "gmpay",
	"EPay 兼容接口": "epay",
	"EPay compatibility API": "epay",
	"错误、限流与故障恢复": "reliability",
	"Errors, rate limits, and recovery": "reliability",
	商城接入交付清单: "launch-checklist",
	"Shop Integration Handoff": "launch-checklist",
};

function headingId(children: unknown) {
	const text = Array.isArray(children) ? children.join("") : String(children);
	return (
		headingIds[text] ??
		text
			.toLowerCase()
			.trim()
			.replace(/[^\p{L}\p{N}]+/gu, "-")
			.replace(/^-|-$/g, "")
	);
}

export function MerchantGuide() {
	const guide = getLocale() === "zh-CN" ? chineseGuide : englishGuide;

	return (
		<article
			className="prose prose-slate dark:prose-invert max-w-none prose-headings:scroll-mt-24 prose-headings:font-semibold prose-headings:tracking-normal prose-a:text-primary prose-a:underline-offset-4 prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-code:text-[0.9em] prose-pre:overflow-x-auto prose-pre:rounded-xl prose-pre:border prose-pre:border-border prose-pre:bg-muted/60 prose-table:block prose-table:overflow-x-auto prose-th:bg-muted/50 prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2"
			data-merchant-guide
		>
			<Markdown
				remarkPlugins={[remarkGfm]}
				components={{
					h1: ({ children, ...props }) => (
						<h2 className="!mb-4 !text-2xl sm:!text-3xl" {...props}>
							{children}
						</h2>
					),
					h2: ({ children, ...props }) => (
						<h2 id={headingId(children)} {...props}>
							{children}
						</h2>
					),
					h3: ({ children, ...props }) => (
						<h3 id={headingId(children)} {...props}>
							{children}
						</h3>
					),
					a: ({ children, href, ...props }) => {
						if (
							href === "../en-US/MERCHANT_API.md" ||
							href === "../zh-CN/MERCHANT_API.md"
						)
							return <span>{children}</span>;
						return (
							<a {...props} href={href} rel="noreferrer" target="_blank">
								{children}
							</a>
						);
					},
					pre: ({ children }) => <pre>{children}</pre>,
				}}
			>
				{guide}
			</Markdown>
		</article>
	);
}
