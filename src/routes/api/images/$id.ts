/**
 * Chart screenshots, served only after sign-in. The store is private, so this is
 * the only way to read one. See `server/imageResponse.ts`.
 */
import { createFileRoute } from '@tanstack/react-router'
import { serveImage } from '~/server/imageResponse'

export const Route = createFileRoute('/api/images/$id')({
  server: {
    handlers: {
      GET: ({ request, params }: { request: Request; params: { id: string } }) => serveImage(request, params.id),
    },
  },
})
