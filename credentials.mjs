const KEY='lifegress:personal-hq:credential:v1';
export function credentialStore(storage){return {
 read(){try{return storage.getItem(KEY)||'';}catch{return '';}},
 remember(token){try{storage.setItem(KEY,token);return true;}catch{return false;}},
 forget(){try{storage.removeItem(KEY);return true;}catch{return false;}}
};}
