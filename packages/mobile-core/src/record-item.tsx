import { Pressable, Text, View } from "react-native";
import { CalendarDays, ChevronRight, MapPin, ArrowDownLeft, ReceiptText } from "@ou/mobile-ui";
import { balanceDescription, recordStatus, type ListRow, type Resource } from "@ou/contracts";
import { Avatar, Badge, colors, Row, styles } from "@ou/mobile-ui";

export function RecordItem({ resource, row, onPress }: { resource: Resource; row: ListRow; onPress?: () => void }) {
  const session = ["sessions","upcomingSessions","mySessions"].includes(resource);
  const statistics = ["statistics","myStatistics"].includes(resource);
  const balance = ["balances","myBalances"].includes(resource);
  const transaction = ["payments","myPayments","expenses"].includes(resource);
  const stats = /^(\d+) goals \/ (\d+) assists \/ (\d+) appearances$/.exec(row.detail);
  const date = session ? /^(\d{4}-\d{2}-\d{2}) \/ (.+)$/.exec(row.subtitle) : null;
  const parsedDate = date ? new Date(`${date[1]}T12:00:00Z`) : null;
  const validDate = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;
  const cash = transaction ? /^([A-Z]{3} -?\d+\.\d{2})(?: \/ (.*))?$/.exec(row.detail) : null;
  const status = recordStatus(resource,row);
  if (!(session || statistics && stats || balance || transaction && cash || resource === "members" || resource === "players")) return <Row {...row} onPress={onPress}/>;
  return <Pressable accessibilityRole={onPress ? "button" : undefined} disabled={!onPress} onPress={onPress} style={({pressed})=>[styles.card,{padding:12,gap:10},pressed&&{backgroundColor:colors.soft}]}>
    <View style={{flexDirection:"row",gap:10,alignItems:"center"}}>
      {session ? <View style={{width:48,minHeight:54,backgroundColor:colors.soft,borderRadius:6,justifyContent:"center",alignItems:"center",paddingVertical:5}}>
        {validDate ? <><Text style={{fontSize:10,fontWeight:"700",color:colors.green}}>{validDate.toLocaleDateString("en",{month:"short",timeZone:"UTC"}).toUpperCase()}</Text><Text style={{fontSize:24,lineHeight:28,fontWeight:"700",color:colors.forest,fontVariant:["tabular-nums"]}}>{validDate.getUTCDate()}</Text></> : <CalendarDays size={22} color={colors.green}/>}
      </View> : transaction ? <View style={{width:36,height:36,borderRadius:8,backgroundColor:"#EAF1FA",alignItems:"center",justifyContent:"center"}}>{resource==="expenses"?<ReceiptText color={colors.blue} size={19}/>:<ArrowDownLeft color={colors.blue} size={19}/>}</View> : <Avatar name={row.title}/>}
      <View style={{flex:1,gap:4}}>
        <Text style={styles.title}>{row.title}</Text>
        {session ? <Text style={styles.muted}>{validDate?`${validDate.toLocaleDateString("en",{weekday:"long",timeZone:"UTC"})} / ${validDate.getUTCFullYear()}`:row.subtitle}</Text> : <Text style={styles.muted}>{row.subtitle}</Text>}
      </View>
      {status && resource!=="members" ? <Badge label={status}/> : null}
      {onPress ? <ChevronRight size={17} color={colors.muted}/> : null}
    </View>
    {session && row.detail ? <View style={{flexDirection:"row",gap:6,alignItems:"center",paddingTop:8,borderTopWidth:1,borderColor:colors.border}}><MapPin size={14} color={colors.muted}/><Text style={[styles.muted,{flex:1}]}>{row.detail}</Text></View> : null}
    {statistics && stats ? <View style={{flexDirection:"row",paddingTop:8,borderTopWidth:1,borderColor:colors.border}}>{["Goals","Assists","Played"].map((label,index)=><View key={label} style={{flex:1,alignItems:"center",gap:2}}><Text style={{fontSize:22,lineHeight:28,fontWeight:"700",color:index===0?colors.green:colors.ink,fontVariant:["tabular-nums"]}}>{stats[index+1]}</Text><Text style={styles.muted}>{label}</Text></View>)}</View> : null}
    {balance ? <View style={{flexDirection:"row",alignItems:"baseline",justifyContent:"space-between",flexWrap:"wrap",gap:8,paddingTop:8,borderTopWidth:1,borderColor:colors.border}}><Text style={styles.muted}>{balanceDescription(row.detail)}</Text><Text style={{fontSize:23,lineHeight:29,fontWeight:"700",color:row.detail.includes(" -")?colors.error:colors.forest,fontVariant:["tabular-nums"]}}>{row.detail}</Text></View> : null}
    {transaction && cash ? <View style={{flexDirection:"row",flexWrap:"wrap",gap:8,alignItems:"baseline",justifyContent:"space-between"}}>{cash[2]?<Text style={[styles.muted,{flexShrink:1}]}>{cash[2]}</Text>:null}<Text style={{fontSize:19,fontWeight:"700",color:colors.ink,fontVariant:["tabular-nums"]}}>{cash[1]}</Text></View> : null}
    {(resource==="members" || resource==="players") && row.detail ? <Text style={styles.muted}>{row.detail}</Text> : null}
  </Pressable>;
}
