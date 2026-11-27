export type ThemePreference="system"|"light"|"dark";
export type EffectiveTheme="light"|"dark";
export function normalizeTheme(value:unknown):ThemePreference{
 return value==="light"||value==="dark"||value==="system"?value:"system";
}
export function resolveTheme(preference:unknown,systemDark:boolean):EffectiveTheme{
 const theme=normalizeTheme(preference);
 return theme==="system"?(systemDark?"dark":"light"):theme;
}
export function nextTheme(preference:unknown,systemDark:boolean):EffectiveTheme{
 return resolveTheme(preference,systemDark)==="dark"?"light":"dark";
}
export function savedTheme():ThemePreference{
 try{return normalizeTheme(JSON.parse(localStorage.getItem("seven-mail:settings")||"{}")?.theme);}
 catch{return "system";}
}
export function applyTheme(preference:unknown,systemDark:boolean):void{
 document.documentElement.dataset.theme=resolveTheme(preference,systemDark);
}
