import { Pressable, Text, View } from "react-native";
import { Shirt } from "lucide-react-native";
import { colors } from "@ou/mobile-ui";
import type { PitchPosition } from "./planning-layout";

export function Pitch({ positions, players, selected, onSelect, disabled }: {
  positions: PitchPosition[]; players: {id:string;name:string}[]; selected: number | null;
  onSelect(index:number):void; disabled:boolean;
}) {
  return <View style={{aspectRatio:0.78,minHeight:360,backgroundColor:"#116844",borderRadius:8,overflow:"hidden",borderWidth:1,borderColor:colors.forest}}>
    <View pointerEvents="none" style={{position:"absolute",inset:12,borderWidth:1,borderColor:"#FFFFFF66"}}>
      <View style={{position:"absolute",top:"50%",width:"100%",borderTopWidth:1,borderColor:"#FFFFFF66"}}/>
      <View style={{position:"absolute",top:"40%",left:"36%",width:"28%",height:"20%",borderRadius:100,borderWidth:1,borderColor:"#FFFFFF66"}}/>
      {["top","bottom"].map(edge=><View key={edge} style={{position:"absolute",[edge]:0,left:"22%",width:"56%",height:"16%",borderWidth:1,borderColor:"#FFFFFF66"}}/>)}
    </View>
    {positions.map((position,index)=>{
      const name=players.find(player=>player.id===position.playerId)?.name;
      return <Pressable key={position.slot} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${position.label || "Position"}: ${name || "Unassigned"}`} accessibilityState={{selected:selected===index,disabled}} onPress={()=>onSelect(index)}
        style={{position:"absolute",left:`${10 + Math.max(0,Math.min(100,position.y))*.8}%`,top:`${8 + (100-Math.max(0,Math.min(100,position.x)))*.78}%`,width:78,marginLeft:-39,marginTop:-22,alignItems:"center",minHeight:48}}>
        <Shirt size={30} fill={position.jerseyColor || (position.label==="GK"?"#F3C85B":"white")} color={selected===index?"#F3C85B":"#D6E9DF"}/>
        <Text numberOfLines={1} style={{maxWidth:56,fontSize:11,lineHeight:15,fontWeight:"700",textAlign:"center",color:"white",backgroundColor:selected===index?colors.ink:"#064631",paddingHorizontal:1,borderRadius:3}}>{name?.split(" ")[0] || `+ ${position.label || index+1}`}</Text>
      </Pressable>;
    })}
  </View>;
}
