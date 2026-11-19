/** launchd can briefly reject bootstrap while a booted-out job is being removed. */
export async function bootstrapAfterStop(bootstrap:()=>number,isLoaded:()=>boolean,wait:(ms:number)=>Promise<void>):Promise<number>{
  let code=bootstrap();
  for(const delay of [250,500,1000,2000]){
    if(code!==5)return code;
    // A booted-out service may still appear loaded until shutdown finishes.
    await wait(delay);
    if(!isLoaded())code=bootstrap();
  }
  return code;
}
