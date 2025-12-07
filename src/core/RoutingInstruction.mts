export class RoutingInstruction extends Error {}

export const STOP = /*@__PURE__*/ new RoutingInstruction('STOP');
export const CONTINUE = /*@__PURE__*/ new RoutingInstruction('CONTINUE');
export const NEXT_ROUTE = /*@__PURE__*/ new RoutingInstruction('NEXT_ROUTE');
export const NEXT_ROUTER = /*@__PURE__*/ new RoutingInstruction('NEXT_ROUTER');
