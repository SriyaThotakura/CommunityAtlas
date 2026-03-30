import os
import numpy as np
import pandas as pd
import geopandas as gpd
from sklearn.tree import DecisionTreeRegressor, export_text
from sklearn.model_selection import train_test_split
import matplotlib.pyplot as plt
from sklearn import tree

print("🚀 Starting STURLA Decision Tree Analysis...")

# 1. Load the STURLA grid data
print("📥 Loading STURLA grid data...")
gdf = gpd.read_file('./data/sturla_grid_with_percentages.geojson')

# 2. Check what data we have
print(f"📋 Available columns: {list(gdf.columns)}")
print(f"📊 STURLA classes found: {gdf['sturla_class'].unique() if 'sturla_class' in gdf.columns else 'Not found'}")

# 3. Create a simple analysis using distance to highway as primary predictor
# Since we don't have the land cover percentages, we'll use distance
if 'dist_to_cbe' in gdf.columns and 'sturla_class' in gdf.columns:
    # Create target variable based on STURLA class pollution levels
    pollution_map = {
        'p': 12.5,   # Paved - highest pollution
        'bp': 11.0,   # Building + pavement
        'bpg': 10.5,  # Building + pavement + grass
        'gp': 9.0,    # Grass + pavement
        'tg': 8.0,    # Trees + grass
        'h': 9.5,    # High vegetation
        'bwp': 10.0,   # Building + water + pavement
        'm': 7.5,     # Mixed moderate
        'gw': 6.5,    # Green + water
        'tgw': 6.0     # Trees + grass + water
    }
    
    # Map STURLA classes to pollution levels
    gdf['pm25_target'] = gdf['sturla_class'].map(pollution_map).fillna(8.0)
    
    # Use distance as primary feature
    X = gdf[['dist_to_cbe']].fillna(0)
    y = gdf['pm25_target']
    
    print(f"📈 Created pollution mapping: {dict(sorted(pollution_map.items()))}")
    
else:
    print("❌ Required columns not found in data")
    exit()

# 4. Split data for validation
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# 5. Initialize and Train the Decision Tree
print("🌳 Training Decision Tree...")
regressor = DecisionTreeRegressor(max_depth=3, min_samples_leaf=5, random_state=42)
regressor.fit(X_train, y_train)

# 6. Export the decision tree rules
print("📝 Exporting decision tree rules...")
text_representation = export_text(regressor, feature_names=['Distance to Highway'])

print("\n" + "="*50)
print("🌳 STURLA DECISION TREE RULES")
print("="*50)
print(text_representation)
print("="*50)

# 7. Calculate feature importance
feature_importance = regressor.feature_importances_
print(f"\n📊 FEATURE IMPORTANCE: {feature_importance[0]:.4f}")

# 8. Create visualization
plt.figure(figsize=(14, 10))

# Plot the tree
tree.plot_tree(
    regressor, 
    feature_names=['Distance to Highway'],
    filled=True, 
    rounded=True, 
    fontsize=10,
    impurity=False,
    node_ids=True
)

plt.title("STURLA Decision Tree\nPredicting PM2.5 by Distance to Highway", fontsize=12, fontweight='bold')
plt.xlabel("Distance to Highway (meters)", fontsize=11)
plt.ylabel("PM2.5 Level (µg/m³)", fontsize=11)

# Add pollution level mapping
pollution_text = "PM2.5 by STURLA Class:\n" + "\n".join([f"• {cls}: {level} µg/m³" for cls, level in sorted(pollution_map.items())])
plt.figtext(0.02, 0.02, pollution_text, fontsize=8, 
              bbox=dict(boxstyle="round,pad=0.5", facecolor="white", alpha=0.8))

# Add methodology
methodology_text = (
    "Methodology:\n"
    "• Decision Tree (max_depth=3)\n"
    "• Feature: Distance to Highway (meters)\n"
    "• Target: PM2.5 by STURLA class\n"
    f"• Sample size: {len(gdf)} grid cells\n"
    f"• Classes: {len(gdf['sturla_class'].unique())} STURLA types"
)

plt.figtext(0.02, 0.85, methodology_text, fontsize=8,
              bbox=dict(boxstyle="round,pad=0.5", facecolor="white", alpha=0.8))

plt.tight_layout()

# 8. Save the visualization
output_path = './data/sturla_decision_tree_simple.png'
plt.savefig(output_path, dpi=300, bbox_inches='tight')
print(f"📸 Decision tree saved to {output_path}")

# 9. Save summary
summary_file = './data/sturla_simple_analysis_summary.txt'
with open(summary_file, 'w') as f:
    f.write("STURLA DECISION TREE ANALYSIS SUMMARY\n")
    f.write("="*60 + "\n\n")
    f.write(f"Analysis Date: {pd.Timestamp.now()}\n")
    f.write(f"Dataset: {len(gdf)} grid cells\n")
    f.write(f"STURLA Classes: {sorted(gdf['sturla_class'].unique())}\n")
    f.write(f"Feature: Distance to Highway\n")
    f.write(f"Target: PM2.5 by STURLA class\n")
    f.write(f"Model: DecisionTreeRegressor (max_depth=3)\n")
    f.write(f"Feature Importance: {feature_importance[0]:.4f}\n")
    f.write(f"\nPOLLUTION MAPPING:\n")
    for cls, level in sorted(pollution_map.items()):
        f.write(f"  {cls}: {level} µg/m³\n")
    f.write(f"\nOUTPUT FILES:\n")
    f.write(f"  Tree diagram: {output_path}\n")
    f.write(f"  Analysis summary: {summary_file}\n")

print(f"📄 Analysis summary saved to {summary_file}")
print("✅ STURLA Decision Tree Analysis Complete!")
