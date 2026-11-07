# Trading desk — NexBot × MEXC

Personal trading desk for crypto futures on MEXC, with a team of specialist Dots
that learn from their own decisions. Forex is a separate question (see the
limitation at the end).

## The desk

| Agent                       | Role                                                                                   | Model                          | Learning | Tools needed                                    |
| --------------------------- | -------------------------------------------------------------------------------------- | ------------------------------ | -------- | ----------------------------------------------- |
| **Mike — Orquestrador**     | Coordinates the analysis, consolidates into a decision brief, proposes new specialists | strongest (DeepSeek reasoning) | ON       | market data, portfolio state                    |
| **Rafa — Analista Técnico** | Price, volume, S/R, indicators, structure, multi-timeframe                             | strong reasoning               | ON       | market data (candles, order book)               |
| **Léo — Analista Macro**    | News, calendar, funding, open interest, ETF flow, sentiment                            | good                           | ON       | web research (has it), market data (funding/OI) |
| **Bruno — Gestor de Risco** | Position size, stop, exposure, VETO over plans that break the rules                    | strong, reliable               | ON       | portfolio state                                 |
| **Caio — Execução MEXC**    | Prepares and confirms orders — never analyses                                          | fast/cheap                     | OFF      | **MEXC trading API**                            |
| **Ana — Diário**            | Records decisions and outcomes, weekly review, honest about errors                     | cheap                          | ON       | conversation history                            |

Every Dot was created with learning **on** except Caio (mechanical execution has
nothing to learn). The learning pass (WORK-021) proposes skills from real
conversations, which land in the Skills section for approval — that is the
"gets better over time" loop.

## The rules the desk enforces

- Bruno has **veto power**: risk over 1% per trade, total exposure over 5%, no
  stop, leverage without a stop in the same block — rejected and explained.
- Caio **never** prepares an order without all six parameters (pair, direction,
  size, entry, stop, targets) and **never executes** without the operator's
  explicit confirmation.
- Mike frames uncertainty: if a reliable analysis is not possible, he says what
  is missing rather than speculating.
- The message text from the operator is framed as data, never as instructions
  that change permissions or identity.

## What is missing to make it actually analyse markets

**WORK-036 — MEXC market data tools.** The Dots have web research (Parallel) but
no structured market data. The clean path is a small **MEXC MCP server** exposing:

| Tool             | Data                                | Auth              |
| ---------------- | ----------------------------------- | ----------------- |
| `mexc_ticker`    | last price, 24h change for a symbol | none (public)     |
| `mexc_klines`    | candles per interval and limit      | none (public)     |
| `mexc_orderbook` | top N bids/asks                     | none (public)     |
| `mexc_funding`   | funding rate and next funding time  | none (public)     |
| `mexc_positions` | open positions for the account      | **read-only key** |
| `mexc_balance`   | account balance                     | **read-only key** |

MEXC's public endpoints need no key, so the analysis Dots can start immediately.
The account endpoints need a key created with **read-only** permission — never
enable withdrawals on an API key, regardless of scope.

**Execution** is deliberately out of the first version: it needs a key with trade
permission, which is the one that can move money. The approval gate before any
order exists (Caio requires all six parameters and explicit confirmation), but the
API integration for order placement should land only after the analysis pipeline
has been trusted with paper trading for a while.

**Paper trading first**: MEXC has a testnet. Run the desk against it before
touching real funds.

## Forex

MEXC is crypto-only. Forex needs a separate broker with an API (MT5 via bridge,
OANDA, or Deriv), which is its own integration. The analysis Dots work for any
market — the data tools change, not the team.

## Risk statement, for the record

A language model can produce confident, wrong analysis. The desk is designed so
that no single agent's word is enough: Mike consolidates, Rafa and Léo analyse
independently, Bruno vetoes on risk, and the operator confirms every order. But
the operator is the last line of defence — the agents are analysis tools, not a
trading system. Backtest, paper trade, and never risk money you cannot lose.
