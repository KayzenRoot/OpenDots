# NexBot — customer guide

From download to a working agent. Written for the person installing it, not for
a developer.

## 1. What you need before you start

- A Windows computer (or a Linux server for the hosted setup).
- **Docker Desktop** installed and running. NexBot runs as containers; nothing
  else needs to be installed.
- An **API key from a model provider**. Any OpenAI-compatible service works:
  OpenCode Go, OpenAI, OpenRouter, Groq, a local Ollama, and others.
- Optional: a Slack workspace, if you want to talk to your agents from Slack.

## 2. Install

1. Run `NexBot-Setup.exe` and accept the prompts.
   It installs into your user folder, so no administrator password is needed.
2. When it asks for your provider details, you can either fill them in now or
   leave them blank and do it later inside the app:
   - **Base URL** — your provider's endpoint, e.g. `https://opencode.ai/zen/go/v1`
   - **Model** — the model name, e.g. `deepseek-v4.1-flash`
   - **API key** — the key from your provider
3. At the end it prints an **access token**. Write it down: it is the password
   for your installation and it is not shown again.
4. NexBot opens in its own window, and a shortcut appears on your Desktop.

If you skipped the provider questions, open **Settings & setup** inside the app,
fill in the three fields and press **Test connection**, then **Save**. Nothing is
saved unless your provider accepts the key, so a typo cannot silently break every
conversation.

## 3. Your first agent

1. In the left sidebar, create a **Dot** — that is one agent with its own
   instructions and permissions.
2. Give it a role, for example: _"You are my research assistant. Be concise and
   cite sources."_
3. Decide what it may do: browse the public web, remember things, use connected
   apps. Everything is off unless you allow it.
4. Type a message and send it. The first reply confirms your provider works.

**Spaces** group pages and agents around a subject. **Recent chats** keeps your
conversations; they are stored on your machine and stay there.

## 4. Talking to an agent from Slack (optional)

1. Create a Slack app from `deployment/slack-app-manifest.json` (in the
   installation folder) and install it to your workspace.
2. Copy the **Bot Token** and **Signing Secret** into the `.env.local` file in
   the installation folder.
3. Add your Slack member ID to `SLACK_USER_IDS`. Only IDs listed there can
   trigger an agent — this is what stops anyone else in the workspace from
   spending your model budget.
4. Invite the bot to a channel and mention it.

Slack requires a publicly reachable HTTPS address. On a laptop that means a
tunnel, which is fragile; for daily use, run NexBot on a server with a domain.
See [DEPLOYMENT.md](./DEPLOYMENT.md).

## 5. Backups

Two things hold your data and they must be kept together:

- **PostgreSQL** — conversations and messages;
- **SQLite** — Spaces, Dots, pages and connections.

`deployment/backup.sh` copies both into one timestamped folder. Run it on a
schedule and copy the result somewhere else — a backup that only exists on the
same disk is not a backup. `deployment/restore.sh` puts it back.

## 6. Keeping it running

- NexBot starts automatically when you log in.
- A small **watchdog** runs alongside it: if the app stops answering, it
  restarts the stack once. Its log is in `logs/watchdog.log` in the
  installation folder.
- To stop or check it manually:

  ```powershell
  powershell -File deployment\windows\stop.ps1
  powershell -File deployment\windows\status.ps1
  ```

## 7. Common questions

**Where is my data?**
In Docker volumes on this machine. Nothing is sent to us — the only external
service is the model provider you configured, plus Slack if you enabled it.

**Which provider should I choose?**
Whichever you already pay for. The app does not prefer any of them. If you want
to run models locally, install Ollama and use `http://localhost:11434/v1`.

**The app says "Setup required".**
`/api/ready` names the missing configuration in the response body. Usually it is
the provider key: open Settings and save it again.

**I lost my access token.**
It is in `.env.local` (the `OWNER_TOKEN` line) inside the installation folder.

**SmartScreen blocked the installer.**
The installer is not code-signed yet. Choose "More info" then "Run anyway", or
ask for a signed build.

**Something is broken and I want to start over.**
Stop the stack, then delete the volumes `nexbot_nexbot-data` and
`nexbot_nexbot-pgdata` with `docker volume rm`. This erases all conversations
and settings permanently.

## 8. Getting help

Include this when you ask for support:

- the output of `powershell -File deployment\windows\status.ps1`
- the last lines of `logs/watchdog.log`
- what you did just before the problem appeared

Never send your `.env.local`: it contains your provider key and access token.
