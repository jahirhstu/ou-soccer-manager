export class RpcMetrics {
  private counts:Record<string,{requests:number;request_bytes:number;response_bytes:number;failures:number}>={};
  record(operation:string,request:unknown,response:unknown,failed=false){
    const value=this.counts[operation]??={requests:0,request_bytes:0,response_bytes:0,failures:0};
    value.requests++;value.request_bytes+=Buffer.byteLength(JSON.stringify(request)??'');value.response_bytes+=Buffer.byteLength(JSON.stringify(response)??'');if(failed)value.failures++;
  }
  snapshot(){return{recorded_at:new Date().toISOString(),note:'Estimated JSON payload bytes; excludes HTTP/TLS overhead. Supabase Usage is authoritative.',operations:this.counts};}
}
