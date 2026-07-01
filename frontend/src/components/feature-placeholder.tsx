import { DataEmpty } from "@/components/data-states";
import * as m from "@/paraglide/messages";

type FeaturePlaceholderProps = {
	title: string;
	description: string;
};

export function FeaturePlaceholder({ title, description }: FeaturePlaceholderProps) {
	return (
		<main className="flex flex-col gap-6 p-6 lg:p-8">
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-bold">{title}</h1>
				<p className="text-sm text-muted-foreground">{description}</p>
			</div>

			<DataEmpty
				title={m.placeholder_unavailable_title()}
				description={m.placeholder_unavailable_description()}
			/>
		</main>
	);
}
