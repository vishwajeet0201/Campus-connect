import { ProfilePage } from "@/components/profile/ProfilePage";

export default async function Page({ params }: { params: Promise<{ username: string }> }) {
  return <ProfilePage username={(await params).username} />;
}
