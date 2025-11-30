#!/bin/bash

# Script pour pousser tous les fichiers frontend sur GitHub
# Usage: ./push_frontend_to_github.sh

echo "🚀 Préparation du push des fichiers frontend vers GitHub..."

# Vérifier si on est dans le bon répertoire
if [ ! -d "frontend" ]; then
    echo "❌ Erreur: Le dossier 'frontend' n'existe pas dans ce répertoire"
    exit 1
fi

# Configuration Git (modifiez avec vos informations)
GIT_REPO="https://github.com/nexusproject2077/nexus-social.git"
BRANCH="main"

echo "📦 Ajout de tous les fichiers frontend..."
git add app/frontend/

echo "📝 Vérification des fichiers à pousser..."
git status

echo ""
read -p "❓ Voulez-vous continuer avec le commit et le push? (y/n) " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]
then
    echo "💾 Création du commit..."
    git commit -m "Add complete frontend with all components, pages and UI"
    
    echo "⬆️  Push vers GitHub..."
    git push origin $BRANCH
    
    if [ $? -eq 0 ]; then
        echo "✅ Push réussi!"
        echo "🌐 Vercel va redéployer automatiquement depuis GitHub"
    else
        echo "❌ Erreur lors du push"
        exit 1
    fi
else
    echo "❌ Operation annulée"
    exit 0
fi
