/** Deterministic ordering helpers for message-derived chat state. */

type OrderedMessage = {
  _creationTime: number;
  createdAt: number;
};

export function selectLatestStandaloneMessage<T extends OrderedMessage>(
  latestUserMessage: T | null,
  latestSystemMessage: T | null,
): T | undefined {
  return [latestUserMessage, latestSystemMessage]
    .filter((message): message is T => message !== null)
    .sort(
      (left, right) => right.createdAt - left.createdAt || right._creationTime - left._creationTime,
    )[0];
}
