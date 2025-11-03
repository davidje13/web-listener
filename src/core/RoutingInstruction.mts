export class RoutingInstruction extends Error {}

export const STOP = new RoutingInstruction('STOP');
export const CONTINUE = new RoutingInstruction('CONTINUE');
export const NEXT_ROUTE = new RoutingInstruction('NEXT_ROUTE');
export const NEXT_ROUTER = new RoutingInstruction('NEXT_ROUTER');
