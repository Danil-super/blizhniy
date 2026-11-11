"use client";
import {createContext,useContext,type ReactNode} from 'react';
const Context=createContext(false),SimulationContext=createContext(false),WorkActionsContext=createContext(false);
export function ListingWorkflowProvider({postmoderation,localSimulation=false,workOwnerActions=false,children}:{postmoderation:boolean;localSimulation?:boolean;workOwnerActions?:boolean;children:ReactNode}){return <Context.Provider value={postmoderation}><SimulationContext.Provider value={localSimulation}><WorkActionsContext.Provider value={workOwnerActions}>{children}</WorkActionsContext.Provider></SimulationContext.Provider></Context.Provider>;}
export function useListingPostmoderation(){return useContext(Context);}

export function useLocalPaymentSimulation(){return useContext(SimulationContext);}
export function useWorkOwnerActions(){return useContext(WorkActionsContext);}
