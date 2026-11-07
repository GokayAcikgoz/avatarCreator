import { PublicAvatarView } from "./PublicAvatarView";

export default async function PublicAvatarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PublicAvatarView avatarId={id} />;
}
