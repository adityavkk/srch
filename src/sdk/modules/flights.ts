import { defineModule } from "../define.js";
import { flightsDomain } from "../domains/flights.js";
import { rewardsFlightsDomain } from "../domains/rewards-flights.js";
import { fliSource } from "../sources/fli.js";
import { seatsAeroSource } from "../sources/seats-aero.js";
import { flightsDefaultStrategy } from "../strategies/flights-default.js";
import { rewardsDefaultStrategy } from "../strategies/rewards-default.js";

export const flightsModule = defineModule({
  name: "flights",
  sources: [fliSource, seatsAeroSource],
  strategies: [flightsDefaultStrategy, rewardsDefaultStrategy],
  domains: [flightsDomain, rewardsFlightsDomain]
});
