import { test as base, expect } from '@playwright/test';
export { expect };
export type { Locator, Page } from '@playwright/test';

type AllowedFailure = { pathname: string; status: number };
type Failure = { message: string; pathname?: string; status?: number };
export const test = base.extend<{ allowedHTTPFailures: AllowedFailure[]; monitorFailures: void }>({
  allowedHTTPFailures: async ({}, use) => { await use([]); },
  monitorFailures: [async ({ page, baseURL, allowedHTTPFailures }, use, testInfo) => {
    const failures: Failure[]=[];
    const origin=new URL(baseURL!).origin;
    const local=(raw:string)=>new URL(raw).origin===origin;
    page.on('pageerror',error=>failures.push({message:`JavaScript: ${error.message}`}));
    page.on('requestfailed',request=>{
      if(local(request.url())) failures.push({message:`Request failed: ${request.url()} (${request.failure()?.errorText})`});
    });
    page.on('response',response=>{
      if(local(response.url()) && response.status()>=400) failures.push({message:`HTTP ${response.status()}: ${response.url()}`,pathname:new URL(response.url()).pathname,status:response.status()});
    });
    await use();
    const unexpected=failures.filter(f=>!allowedHTTPFailures.some(a=>a.pathname===f.pathname && a.status===f.status));
    if(unexpected.length) await testInfo.attach('browser-failures',{body:JSON.stringify(unexpected,null,2),contentType:'application/json'});
    expect(unexpected,'unexpected browser/application failures').toEqual([]);
  },{auto:true}],
});
