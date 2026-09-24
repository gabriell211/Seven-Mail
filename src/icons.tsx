import type { SVGProps } from "react";

export type IconName = "mail"|"calendar"|"people"|"check"|"note"|"rule"|"settings"|"search"|"plus"|"inbox"|"send"|"draft"|"archive"|"trash"|"spam"|"star"|"flag"|"paperclip"|"refresh"|"chevron"|"more"|"reply"|"forward"|"filter"|"cloud"|"shield"|"moon"|"sun"|"x"|"userplus"|"clock"|"lock"|"pin"|"upload"|"download"|"copy";

const paths: Record<IconName, string[]> = {
  mail:["M4 6h16v12H4z","m4 7 8 6 8-6"], calendar:["M5 5h14v14H5z","M8 3v4M16 3v4M5 9h14"],
  people:["M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z","M2 21a7 7 0 0 1 14 0","M16 4a4 4 0 0 1 0 8","M18 14a6 6 0 0 1 4 7"],
  check:["M5 12l4 4L19 6"], note:["M5 4h14v16H5z","M8 8h8M8 12h8M8 16h5"],
  rule:["M4 6h7M15 6h5M4 12h3M11 12h9M4 18h10M18 18h2","M11 4v4M7 10v4M14 16v4"],
  settings:["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z","M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"],
  search:["m21 21-4.3-4.3","M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z"], plus:["M12 5v14M5 12h14"],
  inbox:["M4 4h16v15H4z","M4 14h5l2 3h2l2-3h5"], send:["M3 12 21 3l-6 18-4-7-8-2Z","m11 2-3 9"],
  draft:["M5 3h10l4 4v14H5z","M14 3v5h5","M8 14h8M8 18h5"], archive:["M4 7h16v13H4z","M3 4h18v4H3z","M9 12h6"],
  trash:["M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M6 7l1 14h10l1-14"], spam:["M12 3 3 7v6c0 5 4 8 9 9s9-4 9-9V7z","M12 8v5M12 17h.01"],
  star:["m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2-4.5-4.4 6.2-.9z"],
  flag:["M5 21V4h11l-1 5 4 2-4 4H5"], paperclip:["m21.4 11.6-8.9 8.9a6 6 0 1 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7L9.7 17.7a2 2 0 1 1-2.8-2.8l8.2-8.2"],
  refresh:["M20 7v5h-5","M4 17v-5h5","M6.1 8A7 7 0 0 1 18 7l2 5M4 12l2 5a7 7 0 0 0 11.9-1"],
  chevron:["m9 6 6 6-6 6"], more:["M5 12h.01M12 12h.01M19 12h.01"], reply:["m10 8-6 5 6 5v-3c5 0 8 1 10 5-1-7-5-10-10-10z"],
  forward:["m14 8 6 5-6 5v-3c-5 0-8 1-10 5 1-7 5-10 10-10z"], filter:["M4 5h16l-6 7v5l-4 2v-7z"],
  cloud:["M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.4-1.8A5 5 0 0 0 7 18Z"], shield:["M12 3 5 6v6c0 5 3 8 7 9 4-1 7-4 7-9V6z","m9 12 2 2 4-5"],
  moon:["M20 15a8 8 0 0 1-11-11 9 9 0 1 0 11 11Z"], sun:["M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z","M12 2v2M12 20v2M2 12h2M20 12h2"],
  x:["M6 6l12 12M18 6 6 18"], userplus:["M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z","M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6"],
  clock:["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z","M12 6v6l4 2"], lock:["M6 10h12v11H6z","M8 10V7a4 4 0 0 1 8 0v3"],
  pin:["M12 17v5","M5 4h14","m8 4 1 7 3 2 3-2 1-7","M9 15h6"],
  upload:["M12 16V4","m7 9 5-5 5 5","M5 20h14"],
  download:["M12 4v12","m7-5 5 5 5-5","M5 20h14"],
  copy:["M8 8h11v11H8z","M5 16H4V5h11v1"]
};

export function Icon({name,size=20,...props}: SVGProps<SVGSVGElement> & {name:IconName;size?:number}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {paths[name].map((d,i)=><path d={d} key={i}/>)}
  </svg>;
}
