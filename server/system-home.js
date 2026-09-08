import os from 'os';

function getSystemHomeDirectory() {
  try {
    const systemHome = os.userInfo().homedir;
    if (typeof systemHome === 'string' && systemHome.trim()) {
      return systemHome.trim();
    }
  } catch {
    // Fall through to environment-based compatibility fallbacks.
  }

  const fallbackHome = process.platform === 'win32'
    ? (process.env.USERPROFILE || process.env.HOME)
    : (process.env.HOME || process.env.USERPROFILE);

  if (typeof fallbackHome === 'string' && fallbackHome.trim()) {
    return fallbackHome.trim();
  }

  return os.homedir();
}

function createSystemUserEnvironment(baseEnv = process.env) {
  const home = getSystemHomeDirectory();
  const env = {
    ...baseEnv,
    HOME: home
  };

  if (process.platform === 'win32') {
    env.USERPROFILE = home;
  }

  return env;
}

export {
  getSystemHomeDirectory,
  createSystemUserEnvironment
};
