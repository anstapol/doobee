import { resolve } from "node:path"
import { createGitHub } from "./github"
import { handleComment } from "./handlers/comment"
import { handleInstall } from "./handlers/install"
import { handleLabeled } from "./handlers/labeled"
import { handlePrLabeled } from "./handlers/pr-labeled"
import { handleReview } from "./handlers/review"
import { createQueue } from "./queue"

const appId = process.env.APP_ID
const privateKeyPath = process.env.PRIVATE_KEY_PATH
const webhookSecret = process.env.WEBHOOK_SECRET
const reposDir = resolve(process.env.REPOS_DIR ?? "./repos")
const port = parseInt(process.env.PORT ?? "3000", 10)
const botName = process.env.BOT_NAME ?? "doobeebot[bot]"

if (!appId || !privateKeyPath || !webhookSecret) {
  console.error("Missing required env vars: APP_ID, PRIVATE_KEY_PATH, WEBHOOK_SECRET")
  process.exit(1)
}

const privateKey = await Bun.file(privateKeyPath).text()
const github = createGitHub(appId, privateKey, webhookSecret)
const queue = createQueue()

const webhooks = github.app.webhooks

webhooks.on("issues.labeled", async (event) => {
  await handleLabeled(event, github, queue, reposDir)
})

webhooks.on("pull_request.labeled", async (event) => {
  await handlePrLabeled(event, github, queue, reposDir)
})

webhooks.on("issue_comment.created", async (event) => {
  await handleComment(event, github, queue, reposDir, botName)
})

webhooks.on("pull_request_review.submitted", async (event) => {
  await handleReview(event, github, queue, reposDir, botName)
})

webhooks.on("installation.created", async (event) => {
  await handleInstall(event, github)
})

webhooks.on("installation_repositories.added", async (event) => {
  await handleInstall(event, github)
})

webhooks.onError((error) => {
  console.error("[webhook] Error:", error)
})

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === "/health" && req.method === "GET") {
      return Response.json({
        status: "ok",
        active: queue.active(),
        pending: queue.pending(),
      })
    }

    if (url.pathname === "/webhook" && req.method === "POST") {
      const id = req.headers.get("x-github-delivery") ?? ""
      const name = req.headers.get("x-github-event") ?? ""
      const signature = req.headers.get("x-hub-signature-256") ?? ""
      const payload = await req.text()

      try {
        await webhooks.verifyAndReceive({ id, name, payload, signature })
        return new Response("ok", { status: 200 })
      } catch (err) {
        console.error("[webhook] Error:", err)
        const isAuthError =
          err instanceof AggregateError &&
          err.errors?.some(
            (e: unknown) =>
              typeof e === "object" &&
              e !== null &&
              "status" in e &&
              ((e as Record<string, unknown>).status === 401 ||
                (e as Record<string, unknown>).status === 403),
          )
        if (isAuthError) {
          return new Response("unauthorized", { status: 401 })
        }
        return new Response("internal error", { status: 500 })
      }
    }

    return new Response("not found", { status: 404 })
  },
})

console.log(`Doobee server listening on port ${port}`)
