import { NetworkPage } from "@/components/network/NetworkPage";

export default async function Page({ params, searchParams }: { params: Promise<{ department: string }>; searchParams: Promise<{ degree?: string; year?: string }> }) {
  const route = await params;
  const query = await searchParams;
  return <NetworkPage departmentCode={route.department} initialDegree={query.degree} initialYear={query.year ? Number(query.year) : undefined} />;
}
