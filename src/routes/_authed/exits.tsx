/**
 * The old Exit Rules screen. Plans live in the Playbook now and the framework's
 * settings in Settings, but bookmarks and notifications sent before the move
 * still name this address, so it stays as a redirect.
 *
 * Search goes through the Playbook's own schema: what it understands, the account
 * switch above all, survives the trip, and anything else is dropped.
 */
import { createFileRoute, redirect } from '@tanstack/react-router'
import { playbookSearchSchema } from '~/lib/playbookSearch'

export const Route = createFileRoute('/_authed/exits')({
  beforeLoad: ({ search }) => {
    // Parsed here rather than by `validateSearch`, which leaves keys it does not
    // name in what the hook receives.
    throw redirect({ to: '/playbook', search: playbookSearchSchema.parse(search), replace: true })
  },
})
