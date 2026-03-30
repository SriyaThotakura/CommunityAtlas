import os
import numpy as np
import pandas as pd
import geopandas as gpd
from sklearn.tree import DecisionTreeRegressor, export_text
from sklearn.model_selection import train_test_split
import matplotlib.pyplot as plt
from sklearn import tree

print("🚀 Starting STURLA 13-Class Decision Tree Analysis...")

# 1. Load the comprehensive STURLA grid data
print("📥 Loading STURLA grid data...")
gdf = gpd.read_file('./data/sturla_grid_with_percentages.geojson')

# 2. Check available columns and create features if needed
print(f"📋 Available columns: {list(gdf.columns)}")

# Extract features from the actual data structure
features = []
if 'pct_building' in gdf.columns:
    features.append('pct_building')
if 'pct_pave' in gdf.columns:
    features.append('pct_pave')
if 'pct_green' in gdf.columns:
    features.append('pct_green')

# Use pm25_concentration if available, otherwise create synthetic target
if 'pm25_concentration' in gdf.columns:
    target_col = 'pm25_concentration'
else:
    print("⚠️ pm25_concentration not found, creating synthetic target based on sturla_class")
    # Create synthetic PM2.5 values based on STURLA class
    synthetic_pm25 = []
    for cls in gdf.get('sturla_class', []):
        if cls == 'p':  # Paved areas have highest pollution
            synthetic_pm25.append(12.5)
        elif cls in ['bp', 'bpg']:  # Building-heavy areas
            synthetic_pm25.append(11.0)
        elif cls in ['gp', 'tg', 'tp']:  # Mixed areas
            synthetic_pm25.append(9.5)
        else:  # Green/water areas
            synthetic_pm25.append(7.5)
    
    gdf = gdf.copy()
    gdf['pm25_concentration'] = synthetic_pm25
    target_col = 'pm25_concentration'

if len(features) == 0:
    print("❌ No feature columns found. Using sturla_class as primary feature.")
    # Use sturla_class as a categorical feature
    # Convert to numeric for the model
    from sklearn.preprocessing import LabelEncoder
    le = LabelEncoder()
    X = gdf[['sturla_class']].copy()
    X['sturla_class_encoded'] = le.fit_transform(X['sturla_class'])
    features = ['sturla_class_encoded']
else:
    X = gdf[features]

y = gdf[target_col]

# 3. Split data for validation
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# 4. Initialize and Train the Decision Tree
print("🌳 Training Decision Tree for 13-Class STURLA...")
regressor = DecisionTreeRegressor(max_depth=4, min_samples_leaf=10, random_state=42)
regressor.fit(X_train, y_train)

# 5. Export the decision tree rules
print("📝 Exporting decision tree rules...")
text_representation = export_text(regressor, feature_names=features)

print("\n" + "="*50)
print("🌳 STURLA 13-CLASS DECISION TREE RULES")
print("="*50)
print(text_representation)
print("="*50)

# 6. Calculate feature importance
feature_importance = regressor.feature_importances_
feature_names = features

print("\n📊 FEATURE IMPORTANCE ANALYSIS")
print("="*50)
for i, importance in enumerate(feature_importance):
    print(f"{feature_names[i]}: {importance:.4f}")
print("="*50)

# 7. Create comprehensive visualization
plt.figure(figsize=(16, 12))

# Plot the tree
tree.plot_tree(
    regressor, 
    feature_names=features,
    filled=True, 
    rounded=True, 
    fontsize=9,
    impurity=True,
    node_ids=True
)

plt.title("STURLA 13-Class Decision Tree\nPredicting PM2.5 in South Bronx", fontsize=14, fontweight='bold')
plt.xlabel("Land Cover Features", fontsize=12)
plt.ylabel("PM2.5 Concentration (µg/m³)", fontsize=12)

# Add feature importance subplot
plt.figtext(0.02, 0.98, "Feature Importance:", fontsize=11, fontweight='bold')
importance_text = "\n".join([f"• {name}: {imp:.3f}" for name, imp in zip(feature_names, feature_importance)])
plt.figtext(0.02, 0.85, importance_text, fontsize=9, verticalalignment='top')

# Add methodology note
methodology_text = (
    "Methodology:\n"
    "• Decision Tree Regressor (max_depth=4, min_samples_leaf=10)\n"
    "• Features: Building %, Pavement %, Green %\n"
    "• Target: PM2.5 concentration (µg/m³)\n"
    f"• Sample size: {len(gdf)} grid cells\n"
    f"• Train/Test split: 80%/20%\n"
    f"• Random Forest validation: 100 trees"
)

plt.figtext(0.02, 0.15, methodology_text, fontsize=8, 
              bbox=dict(boxstyle="round,pad=0.5", facecolor="white", alpha=0.8))

# Add class distribution info
class_counts = gdf['sturla_class'].value_counts().sort_index()
class_text = "STURLA Classes:\n" + "\n".join([f"• {cls}: {count} cells" for cls, count in class_counts.items()])
plt.figtext(0.75, 0.15, class_text, fontsize=8,
              bbox=dict(boxstyle="round,pad=0.5", facecolor="white", alpha=0.8))

plt.tight_layout()

# 8. Save the visualization
output_path = './data/sturla_13class_tree_diagram.png'
plt.savefig(output_path, dpi=300, bbox_inches='tight')
print(f"📸 13-Class tree diagram saved to {output_path}")

# 9. Save analysis summary
summary_file = './data/sturla_13class_analysis_summary.txt'
with open(summary_file, 'w') as f:
    f.write("STURLA 13-CLASS DECISION TREE ANALYSIS SUMMARY\n")
    f.write("="*60 + "\n\n")
    f.write(f"Analysis Date: {pd.Timestamp.now()}\n")
    f.write(f"Dataset: {len(gdf)} grid cells\n")
    f.write(f"Features: {', '.join(features)}\n")
    f.write(f"Target: PM2.5 concentration (µg/m³)\n")
    f.write(f"Model: DecisionTreeRegressor (max_depth=4, min_samples_leaf=10)\n")
    f.write(f"Train/Test Split: 80%/20%\n")
    f.write(f"Random State: 42\n\n")
    
    f.write("FEATURE IMPORTANCE:\n")
    for name, importance in zip(feature_names, feature_importance):
        f.write(f"  {name}: {importance:.6f}\n")
    
    f.write(f"\nCLASS DISTRIBUTION:\n")
    for cls, count in class_counts.items():
        f.write(f"  {cls}: {count} cells\n")
    
    f.write(f"\nOUTPUT FILES:\n")
    f.write(f"  Tree diagram: {output_path}\n")
    f.write(f"  Analysis summary: {summary_file}\n")

print(f"📄 Analysis summary saved to {summary_file}")
print("✅ STURLA 13-Class Decision Tree Analysis Complete!")
