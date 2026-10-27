import { InviteAction } from "@/components/invite-action";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteAction token={token} />;
}
