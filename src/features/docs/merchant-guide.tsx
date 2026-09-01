import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getLocale } from "#/paraglide/runtime";
import englishGuide from "../../../docs/en-US/MERCHANT_API.md?raw";
import chineseGuide from "../../../docs/zh-CN/MERCHANT_API.md?raw";

export function MerchantGuide() {
	const guide = getLocale() === "zh-CN" ? chineseGuide : englishGuide;

	return (
		<article
			className="prose prose-slate dark:prose-invert max-w-none prose-headings:scroll-mt-24 prose-headings:font-semibold prose-a:text-primary prose-a:underline-offset-4 prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-code:text-[0.9em] prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:border prose-pre:border-border prose-pre:bg-muted/60 prose-table:block prose-table:overflow-x-auto"
			data-merchant-guide
		>
			<Markdown
				remarkPlugins={[remarkGfm]}
				components={{
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
