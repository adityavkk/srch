# srch travel workflow

`srch` is the research surface for travel.

Use it to:
- research destinations
- compare neighborhoods and hotels
- sketch itineraries
- discover flights and fares
- collect links and evidence before booking

Use native action tools like `letsfg` when you are ready to transact.

## Product boundary

`srch` owns:
- web research
- page fetch and extraction
- flight discovery through `search flights`
- route and airport resolution through `search flights resolve`
- action handoff guidance into `letsfg`

`letsfg` owns:
- agent registration
- GitHub linking for LetsFG access
- offer unlock
- payment setup
- booking
- account/profile inspection

This split keeps `srch` focused on search and synthesis while letting purpose-built transactional tools handle real booking flows.

## Install

Base `srch` install:

```bash
npm install
npm run build
```

Optional flights backend:

```bash
search install flights
```

Preview only:

```bash
search install flights --dry-run
```

Equivalent manual steps:

```bash
npm install letsfg
python3 -m pip install letsfg
python3 -m playwright install chromium
```

## End-to-end journey

### 1. Research the trip

Start broad in `srch`.

```bash
search web "best time to visit barcelona for architecture and beaches"
search web "best neighborhoods to stay in barcelona for first time visitors"
search web "best boutique hotels in barcelona near sagrada familia"
search fetch https://example.com/barcelona-neighborhood-guide
```

What you get:
- cited sources
- quick summaries
- extracted readable pages you can compare side by side

### 2. Build an itinerary hypothesis

Use `srch` to plan the shape of the trip before you book anything.

```bash
search web "3 day barcelona itinerary first time architecture food"
search web "barcelona to montserrat day trip logistics"
search web "best areas to stay for walking access in barcelona"
```

At this point `srch` is helping you answer:
- where should I stay?
- how many days do I need?
- what route and dates look best?

### 3. Resolve airports and routes

Use the flights domain to resolve city names into codes.

```bash
search flights resolve "barcelona"
search flights resolve "new york"
```

Then search fares.

```bash
search flights JFK BCN 2026-06-12 --return 2026-06-19 --sort price
search flights EWR BCN 2026-06-12 --return 2026-06-19 --sort duration
```

What `search flights` gives you:
- fare discovery through LetsFG search
- normalized result output inside `srch`
- best-offer summary
- explicit handoff commands for `letsfg`

### 4. Switch to action mode

Once you know what you want, switch to `letsfg`.

```bash
letsfg register --name my-agent --email me@example.com
letsfg link-github <github-username>
letsfg unlock <offer_id>
letsfg setup-payment
letsfg book <offer_id> --passenger '{"id":"pas_xxx",...}' --email you@example.com
letsfg me
```

This is the intended transition:
- `srch` for research and decision support
- `letsfg` for irreversible or account-bound steps

## Why Playwright is part of the setup

LetsFG's local search runtime uses browser automation for airline connectors.

That is why the optional travel setup includes:

```bash
pip install letsfg
playwright install chromium
```

`srch` does not use Playwright directly. It relies on LetsFG's local runtime for flight search.

## Command reference

In `srch`:

```bash
search flights <origin> <destination> <date>
search flights search <origin> <destination> <date>
search flights resolve <query>
```

In native `letsfg`:

```bash
letsfg register --name my-agent --email me@example.com
letsfg link-github <github-username>
letsfg unlock <offer_id>
letsfg setup-payment
letsfg book <offer_id> --passenger '{...}' --email you@example.com
letsfg me
letsfg system-info
```

## Design principle

Travel should feel like one workflow even when multiple tools are involved.

The intended UX is:
1. Research in one place with `srch`
2. Compare options in one place with `srch`
3. Decide in `srch`
4. Handoff cleanly to the action tool when it is time to book

That keeps the high-trust search layer separate from the high-risk transactional layer.
