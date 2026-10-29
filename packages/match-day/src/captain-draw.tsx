import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, Text, View } from "react-native";
import { Play, Triangle } from "lucide-react-native";
import { colors, styles } from "@ou/mobile-ui";

export const teamColors=["#087D52","#2166A0","#A34C27","#8D4290","#746009","#476370"];
export function CaptainDraw({teams,disabled,onDraw,onBusy}:{teams:{name:string}[];disabled:boolean;onDraw(order:number[]):void;onBusy(value:boolean):void}) {
  const rotation=useRef(new Animated.Value(0)).current;
  const animation=useRef<Animated.CompositeAnimation | null>(null);
  const [spinning,setSpinning]=useState(false);
  const [result,setResult]=useState("");
  const busy=useRef(false);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;animation.current?.stop();};},[]);
  async function spin() {
    if(disabled||busy.current||teams.length<2)return;
    busy.current=true;onBusy(true);setSpinning(true);setResult("");
    const order=teams.map((_,i)=>i);
    for(let i=order.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
    const reduced=await AccessibilityInfo.isReduceMotionEnabled().catch(()=>false);
    if(!mounted.current)return;
    rotation.setValue(0);
    animation.current=Animated.timing(rotation,{toValue:1440+(360-order[0]*360/teams.length)%360,duration:reduced?0:1800,easing:Easing.out(Easing.cubic),useNativeDriver:true});
    animation.current.start(({finished})=>{if(!mounted.current)return;busy.current=false;onBusy(false);setSpinning(false);if(finished){onDraw(order);setResult(`${teams[order[0]].name} picks first`);}});
  }
  return <View style={{alignItems:"center",gap:8}}>
    <View style={{width:170,height:170,alignItems:"center",justifyContent:"center"}}>
      <Animated.View style={{position:"absolute",width:152,height:152,borderRadius:76,borderWidth:20,borderColor:"#E0EBE5",transform:[{rotate:rotation.interpolate({inputRange:[0,1800],outputRange:["0deg","1800deg"]})}]}}>
        {teams.map((team,index)=>{const angle=index*2*Math.PI/teams.length;return <View key={index} style={{position:"absolute",left:56+66*Math.sin(angle)-17,top:56-66*Math.cos(angle)-17,width:34,height:34,borderRadius:17,backgroundColor:teamColors[index%6],alignItems:"center",justifyContent:"center"}}><Text style={{color:"white",fontSize:15,fontWeight:"800"}}>{index+1}</Text></View>;})}
      </Animated.View>
      <Pressable accessibilityRole="button" accessibilityLabel="Spin captain order" disabled={disabled||spinning} onPress={()=>void spin()} style={{width:78,height:78,borderRadius:39,backgroundColor:disabled?colors.muted:colors.forest,alignItems:"center",justifyContent:"center",gap:3}}><Play size={20} color="white"/><Text style={{fontSize:12,fontWeight:"700",color:"white"}}>{spinning?"Drawing":"Spin"}</Text></Pressable>
      <Triangle size={16} fill={colors.ink} color={colors.ink} style={{position:"absolute",top:-6,transform:[{rotate:"180deg"}]}}/>
    </View>
    {result?<Text accessibilityLiveRegion="polite" style={[styles.title,{color:colors.green}]}>{result}</Text>:null}
  </View>;
}
