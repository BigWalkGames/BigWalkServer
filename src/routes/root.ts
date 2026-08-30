import { type FastifyPluginAsync } from 'fastify'

const root: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
  fastify.get('/', async function (request, reply) {
    return { root: true }
  })
  fastify.get('/favicon.ico', async function (request, reply) {
    return reply.code(204).send();
  })
}

export default root
