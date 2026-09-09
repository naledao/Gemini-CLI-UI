export const resolveUiSessionId = ({ selectedSessionId, requestedSessionId }) =>
  selectedSessionId || requestedSessionId || 'new';

export const resolveResumeSessionId = ({
  currentSessionId,
  requestedSessionId,
  resumable
}) => {
  if (!resumable) return null;
  return currentSessionId || requestedSessionId || null;
};
