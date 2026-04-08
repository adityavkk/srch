# srch travel workflow

`srch` is the research surface for travel.

Use it to:
- research destinations
- compare neighborhoods and hotels
- sketch itineraries
- discover flights and fares
- compare award travel options with points and miles
- collect links and evidence before booking

Use `srch` to research and compare, then complete the booking in your preferred airline, OTA, or future booking integration.

## Product boundary

`srch` owns:
- web research
- page fetch and extraction
- flight discovery through `search flights`
- route and airport resolution through `search flights resolve`
- award availability discovery through `search rewards-flights`
- reward-search auth guidance through `search rewards-flights auth`

External booking channels own:
- final booking completion
- passenger and payment collection
- post-booking servicing

This split keeps `srch` focused on search and synthesis while letting purpose-built transactional tools handle real booking flows.

## Install

Base `srch` install:

```bash
npm install
npm run build
```

Flights provider setup:

```bash
search config set-secret-ref duffelAccessToken op 'op://agent-dev/Duffel/access token'
```

Manual fallback:

```bash
export DUFFEL_ACCESS_TOKEN=dfl_test_xxx
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
search rewards-flights auth status
search rewards-flights JFK BCN --start-date 2026-06-12 --end-date 2026-06-19 --cabin business --source flyingblue
```

What `search flights` gives you:
- live fare discovery through Duffel
- normalized result output inside `srch`
- airport/city resolution through Duffel suggestions
- cabin filtering validated against returned segment data

What `search rewards-flights` gives you:
- cached points-and-miles availability via Seats.aero
- loyalty program filtering like `flyingblue`, `aeroplan`, or `alaska`
- trip-level award detail lookup for a specific availability result
- monitored route browsing for a mileage program

### 4. Switch to booking

Once you know what you want, use the fare research from `srch` to complete the booking in your preferred booking channel.

This is the intended transition:
- `srch` for research and decision support
- airline or OTA checkout for irreversible booking steps

## Command reference

In `srch`:

```bash
search flights <origin> <destination> <date>
search flights search <origin> <destination> <date>
search flights resolve <query>
search rewards-flights <origin> <destination>
search rewards-flights routes <source>
search rewards-flights trips <availability_id>
```

## Design principle

Travel should feel like one workflow even when multiple tools are involved.

The intended UX is:
1. Research in one place with `srch`
2. Compare options in one place with `srch`
3. Decide in `srch`
4. Hand off cleanly to a booking channel when it is time to buy

That keeps the high-trust search layer separate from the high-risk transactional layer.
