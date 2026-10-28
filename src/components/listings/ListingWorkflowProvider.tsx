"use client";
import {createContext,useContext,type ReactNode} from 'react';
const Context=createContext(false),SimulationContext=createContext(false);
export function ListingWorkflowProvider({postmoderation,localSimulation=false,children}:{postmoderation:boolean;localSimulation?:boolean;children:ReactNode}){return <Context.Provider value={postmoderation}><SimulationContext.Provider value={localSimulation}>{children}</SimulationContext.Provider></Context.Provider>;}
export function useListingPostmoderation(){return useContext(Context);}

export function useLocalPaymentSimulation(){return useContext(SimulationContext);}
