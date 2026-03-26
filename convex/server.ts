import {
  actionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  mutationGeneric,
  queryGeneric,
} from "convex/server";

export const query = queryGeneric;
export const mutation = mutationGeneric;
export const internalMutation = internalMutationGeneric;
export const internalAction = internalActionGeneric;
export const action = actionGeneric;
