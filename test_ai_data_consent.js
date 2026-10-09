const { choiceFromSettings, isBlocked, mergeChoice } = require('./lib/ai-data-consent');

describe('account AI data consent', () => {
  it('treats a missing choice as unknown and does not block', () => {
    expect(choiceFromSettings(undefined)).toBe('unknown');
    expect(choiceFromSettings({})).toBe('unknown');
    expect(choiceFromSettings('{"coach":{"tier":"trial"}}')).toBe('unknown');
    expect(isBlocked({ coach: { tier: 'trial' } })).toBe(false);
  });

  it('stores one allow or deny on the account settings without dropping other keys', () => {
    const allowed = mergeChoice({ coach: { tier: 'trial' } }, true);
    expect(allowed.aiDataConsent).toBe(true);
    expect(allowed.coach.tier).toBe('trial');
    expect(choiceFromSettings(allowed)).toBe('allow');
    expect(isBlocked(allowed)).toBe(false);

    const denied = mergeChoice(allowed, false);
    expect(denied.aiDataConsent).toBe(false);
    expect(denied.coach.tier).toBe('trial');
    expect(isBlocked(denied)).toBe(true);
  });
});
