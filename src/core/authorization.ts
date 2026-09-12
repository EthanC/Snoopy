import { context, reddit } from '@devvit/web/server';

export async function requireModerator(): Promise<void> {
  const user = await reddit.getCurrentUser();
  if (!user) throw new Error('Sign in as a moderator to manage Snoopy.');

  const permissions = await user.getModPermissionsForSubreddit(
    context.subredditName
  );
  if (permissions.length === 0) {
    throw new Error(`You are not a moderator of r/${context.subredditName}.`);
  }
}
