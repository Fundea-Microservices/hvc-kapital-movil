import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import withObservables from '@nozbe/with-observables';
import { database } from '../../data/local/database';
import CatMenu from '../../data/local/models/CatMenu';
import { Q } from '@nozbe/watermelondb';

// Props para el componente individual del Acordeón
interface AccordionItemProps {
  menuPadre: CatMenu;
  hijos: CatMenu[];
}

// 1. Componente del Item Individual (El Acordeón)
// 1. Componente del Item Individual (El Acordeón) CORREGIDO
const AccordionItem = ({ menuPadre, hijos }: AccordionItemProps) => {
  const [expanded, setExpanded] = useState(false);

  const isLeaf = hijos.length === 0;

  const handlePress = () => {
    if (isLeaf) {
      console.log(`Navegando a: ${menuPadre.ruta_pantalla}`);
    } else {
      setExpanded(!expanded);
    }
  };

  return (
    <View style={styles.menuContainer}>
      {/* Botón Padre */}
      <TouchableOpacity style={styles.parentRow} onPress={handlePress}>
        <Text style={styles.parentText}>
          [{menuPadre.icono || ' '}] {menuPadre.titulo}
        </Text>
        
        {/* CORRECCIÓN: Uso estricto de ternario para evitar el error de texto suelto */}
        {!isLeaf ? (
          <Text style={styles.parentText}>{expanded ? '▲' : '▼'}</Text>
        ) : null}
      </TouchableOpacity>

      {/* Renderizado Dinámico de Hijos: CORRECCIÓN con ternario */}
      {expanded ? (
        hijos.map((hijo) => (
          <TouchableOpacity 
            key={hijo.id} 
            style={styles.childRow} 
            onPress={() => console.log(`Navegando a: ${hijo.ruta_pantalla}`)}
          >
            <Text style={styles.childText}>{hijo.titulo}</Text>
          </TouchableOpacity>
        ))
      ) : null}
    </View>
  );
};

// 2. High-Order Component para vincular un Menú Padre con sus Hijos de forma reactiva
const EnhancedAccordionItem = withObservables(['menuPadre'], ({ menuPadre }: { menuPadre: CatMenu }) => ({
  menuPadre: menuPadre.observe(),
  // Consulta a SQLite: Busca los menús cuyo id_padre sea el id del menú actual
  hijos: database.collections
    .get<CatMenu>('cat_menu_appex')
    .query(Q.where('id_padre', menuPadre.id), Q.sortBy('orden', Q.asc))
    .observe(),
}))(AccordionItem);


// 3. Componente Principal de la Lista de Menús
const MenuList = ({ topLevelMenus }: { topLevelMenus: CatMenu[] }) => {
  return (
    <View style={styles.listContainer}>
      <Text style={styles.title}>Menú Principal</Text>
      {topLevelMenus.map((menu) => (
        <EnhancedAccordionItem key={menu.id} menuPadre={menu} />
      ))}
    </View>
  );
};

// 4. Conexión a la Base de Datos para traer solo Menús Padre
export const DynamicMenu = withObservables([], () => ({
  // Q.where('id_padre', null) extrae solo la raíz del árbol
  topLevelMenus: database.collections
    .get<CatMenu>('cat_menu_appex')
    .query(Q.where('id_padre', null), Q.sortBy('orden', Q.asc))
    .observe(),
}))(MenuList);

// Estilos Nativos Básicos (Ideales para migrar luego a Shopify Restyle)
const styles = StyleSheet.create({
  listContainer: { padding: 15, backgroundColor: '#f9f9f9', flex: 1 },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 20, color: '#333' },
  menuContainer: { marginBottom: 10, backgroundColor: '#fff', borderRadius: 8, overflow: 'hidden', elevation: 2 },
  parentRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 15, backgroundColor: '#005b96' },
  parentText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  childRow: { padding: 15, paddingLeft: 40, borderBottomWidth: 1, borderBottomColor: '#eee' },
  childText: { fontSize: 15, color: '#555' },
});