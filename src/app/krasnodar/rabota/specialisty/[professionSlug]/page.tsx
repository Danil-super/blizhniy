import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ professionSlug: string }>;
};

export default async function Page({ params }: PageProps) {
  const { professionSlug } = await params;

  redirect(`/rabota/specialisty/${professionSlug}`);
}
