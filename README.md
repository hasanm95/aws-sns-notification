# Project 4 — Fan-out Notifications (SNS)

**Pattern:** one SNS topic → many subscribers at once (pub/sub fan-out)
**Idea:** When an "order placed" event happens, lots of things need to react — send
an email, update inventory, run analytics. The publisher should NOT know or care who
is listening. It just shouts once into an SNS topic, and every subscriber gets its own
copy. Adding a new subscriber later means **zero change** to the publisher.

Runs on LocalStack with `lstk sam build / deploy`.

---

## Architecture

```
                         ┌─────────────────────────┐
   publish "order        │   OrderPlacedTopic (SNS) │
   placed" (CLI)  ──────▶│                          │
                         └────────────┬─────────────┘
                                      │  fan-out (one message → everyone)
            ┌─────────────────────────┼───────────────────────────┐
            ▼                         ▼                            ▼
   ┌─────────────────┐     ┌────────────────────┐      ┌────────────────────────┐
   │  EmailFunction  │     │   InventoryQueue    │      │     PremiumQueue        │
   │    (Lambda)     │     │       (SQS)         │      │       (SQS)             │
   │  logs "email    │     │  gets EVERY order   │      │  filter: type=premium  │
   │   sent"         │     │                     │      │  gets ONLY premium     │
   └─────────────────┘     └────────────────────┘      └────────────────────────┘
```

| Resource | Role |
|---|---|
| `OrderPlacedTopic` | the broadcast point — publish here |
| `EmailFunction` | Lambda subscriber; SAM wires the subscription + permission automatically |
| `InventoryQueue` | SQS subscriber; gets **every** message |
| `PremiumQueue` | SQS subscriber with a **filter policy** — only gets `type = premium` |
| `*QueuePolicy` | lets `sns.amazonaws.com` write into each queue (scoped to this topic) |

---

## Deploy

```bash
lstk sam build
lstk sam deploy
```

After deploy, grab the outputs (you need the `TopicArn` to publish):

```bash
lstk aws cloudformation describe-stacks --stack-name aws-sns-notification \
  --query "Stacks[0].Outputs"
```

---

## Test 1 — fan-out (one publish reaches both subscribers)

Publish a plain order to the topic:

```bash
lstk aws sns publish \
  --topic-arn <TopicArn> \
  --message '{"orderId":"order-1","status":"PLACED","amount":500}'
```

**Success checks:**
- The command returns a `MessageId`.
- `EmailFunction` log shows it was invoked:
  ```bash
  lstk aws logs tail /aws/lambda/<EmailFunction-name> --follow
  ```
  You should see `Processing Email Notification -> Order ID: order-1 ...`.
- `InventoryQueue` received the same message:
  ```bash
  lstk aws sqs receive-message --queue-url <QueueUrl>
  ```
  The body is wrapped in an SNS **envelope** — the real order JSON is inside the
  `"Message"` field as a string (see note below).

One publish → two different places got it = **fan-out works**.

---

## Test 2 — filter policy (premium routing)

`PremiumQueue` has a filter policy: `type` must equal `premium`. **Important:** SNS
filter policies match on **message attributes** by default, *not* on the message body.
So the `type` has to be sent as a message attribute, not just put inside the JSON.

First get the premium queue URL (it isn't in Outputs):

```bash
lstk aws sqs list-queues
```

**A normal order (no premium attribute) — should NOT reach PremiumQueue:**

```bash
lstk aws sns publish \
  --topic-arn <TopicArn> \
  --message '{"orderId":"order-2","status":"PLACED","amount":200}'
```
Then `receive-message` on the premium queue → **empty** (filtered out). But
InventoryQueue still gets it.

**A premium order — SHOULD reach PremiumQueue:**

```bash
lstk aws sns publish \
  --topic-arn <TopicArn> \
  --message '{"orderId":"order-3","status":"PLACED","amount":9000}' \
  --message-attributes '{"type":{"DataType":"String","StringValue":"premium"}}'
```
Then `receive-message` on the premium queue → **the message is there**.

So: InventoryQueue gets everything; PremiumQueue only gets `type=premium`. That is
**content-based routing** — the publisher is unchanged, the topic decides who gets what.

---

## Note — the SNS envelope in SQS

The subscriptions here do not set `RawMessageDelivery`, so each message landing in SQS
is wrapped by SNS:

```json
{ "Type": "Notification", "MessageId": "...", "Message": "{\"orderId\":\"order-1\",...}", ... }
```

The real order JSON is the **string** inside `"Message"`. A real inventory consumer
would `JSON.parse(body).Message` first, then parse that. (Set `RawMessageDelivery: true`
on the subscription if you want the raw order to land in the queue directly.)

---

## One-line takeaway

Publish once, everyone subscribed gets a copy, and a filter policy lets the topic route
by content — all without the publisher ever knowing who is listening. That is loose
coupling: new subscribers cost the publisher nothing.
