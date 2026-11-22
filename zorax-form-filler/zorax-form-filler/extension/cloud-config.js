'use strict';

globalThis.zoraxCloudOrigin = value => {
  let url;
  try {url = new URL(String(value).trim());}
  catch {throw new Error('Enter the HTTPS address of your Zorax AI Cloud deployment.');}
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if ((!loopback && url.protocol !== 'https:') || !['http:','https:'].includes(url.protocol)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Use the gateway origin only. HTTP is available for local testing.');
  return {origin:url.origin, pattern:url.protocol + '//' + url.hostname + '/*'};
};
