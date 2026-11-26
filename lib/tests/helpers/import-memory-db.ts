/** Stateful test adapter: filters and mutations execute once, when a query is awaited. */
export function importMemoryDB(records: Record<string,any[]>) {
  let sequence=0;
  return { from(table:string) {
    const filters:Array<(row:any)=>boolean>=[];let operation='read',payload:any,done:any,maximum=Infinity,shape='many';
    const execute=()=>{
      if(done)return done;
      const rows=records[table]??=[];let selected=rows.filter(row=>filters.every(filter=>filter(row)));
      if(operation==='insert'||operation==='upsert') {
        selected=(Array.isArray(payload)?payload:[payload]).map(value=>{
          const existing=operation==='upsert'?rows.find(row=>value.id?row.id===value.id:table==='attendance'?row.session_id===value.session_id&&row.player_id===value.player_id:table==='player_aliases'?row.normalized_alias===value.normalized_alias:false):undefined;
          if(existing){Object.assign(existing,value);return existing;}
          const row={...value,id:value.id??`${table}-${++sequence}`};rows.push(row);return row;
        });
      } else if(operation==='update'){selected.forEach(row=>Object.assign(row,payload));}
      else if(operation==='delete'){records[table]=rows.filter(row=>!selected.includes(row));}
      selected=selected.slice(0,maximum);
      done={data:shape==='many'?selected:selected[0]??null,error:null};return done;
    };
    const q:any={select:()=>q,eq:(key:string,value:any)=>{filters.push(row=>key.includes('->>')?row[key.split('->>')[0]]?.[key.split('->>')[1]]===value:row[key]===value);return q;},neq:(key:string,value:any)=>{filters.push(row=>row[key]!==value);return q;},in:(key:string,value:any[])=>{filters.push(row=>value.includes(row[key]));return q;},is:(key:string,value:any)=>{filters.push(row=>(row[key]??null)===value);return q;},gt:(key:string,value:any)=>{filters.push(row=>row[key]>value);return q;},limit:(n:number)=>{maximum=n;return q;},order:()=>q,insert:(value:any)=>{operation='insert';payload=value;return q;},upsert:(value:any)=>{operation='upsert';payload=value;return q;},update:(value:any)=>{operation='update';payload=value;return q;},delete:()=>{operation='delete';return q;},single:()=>{shape='one';return Promise.resolve(execute());},maybeSingle:()=>{shape='one';return Promise.resolve(execute());},then:(resolve:any,reject:any)=>Promise.resolve(execute()).then(resolve,reject)};return q;
  }};
}
