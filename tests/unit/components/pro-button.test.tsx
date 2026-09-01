import { ArrowRight } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProButton } from "#/components/pro/base/button";

describe("ProButton", () => {
	it("renders one slottable link child with icon and text", () => {
		expect(() =>
			renderToStaticMarkup(
				<ProButton asChild>
					<a href="/evidence">
						<ArrowRight />
						View evidence
					</a>
				</ProButton>,
			),
		).not.toThrow();
	});
});
