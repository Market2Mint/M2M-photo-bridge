export const generateSessionId = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'KSK-';
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

export const splitName = (fullName: string) => {
  const parts = fullName.trim().split(/\s+/);
  const fName = parts[0] || '';
  const lName = parts.slice(1).join(' ') || '';
  return { fName, lName };
};
