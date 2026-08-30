import Fastify from 'fastify'
import app from './app-plugin'

const fastify = Fastify({
  logger: true
})

fastify.register(app)

fastify.listen({
  port: Number(process.env.PORT) || 3000,
  host: '0.0.0.0'
})